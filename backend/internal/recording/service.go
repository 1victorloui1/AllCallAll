package recording

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/rs/zerolog"

	"github.com/allcallall/backend/internal/calllog"
	"github.com/allcallall/backend/internal/config"
	"github.com/allcallall/backend/internal/models"
	"github.com/allcallall/backend/internal/user"
)

const (
	StatusRecording    = "recording"
	StatusUploadedSelf = "uploaded_self"
	StatusUploadedBoth = "uploaded_both"
	StatusProcessing   = "processing"
	StatusReady        = "ready"
	StatusFailed       = "failed"

	defaultSampleRate = 16000
	defaultFormat     = "wav"
	dedupWindowMs     = 1250
)

// TranscriptSegment represents a single utterance segment.
type TranscriptSegment struct {
	Speaker string `json:"speaker"`
	StartMs int64  `json:"start_ms"`
	EndMs   int64  `json:"end_ms"`
	Text    string `json:"text"`
}

// RecordingDetail is returned to clients.
type RecordingDetail struct {
	CallID               string              `json:"call_id"`
	Status               string              `json:"status"`
	TargetLang           string              `json:"target_lang"`
	Transcript           []TranscriptSegment `json:"transcript"`
	SummaryText          string              `json:"summary_text"`
	TranslatedTranscript string              `json:"translated_transcript"`
	TranslatedSummary    string              `json:"translated_summary"`
	ErrorMessage         string              `json:"error_message"`
}

// Service handles call recording workflow.
type Service struct {
	repo       *Repository
	callLogs   *calllog.Repository
	users      *user.Service
	logger     zerolog.Logger
	asr        *aliyunASRClient
	llm        *openRouterClient
	storageDir string
}

// NewService constructs Service.
func NewService(repo *Repository, callLogs *calllog.Repository, users *user.Service, asrCfg config.ASRConfig, llmCfg config.OpenRouterConfig, logger zerolog.Logger) *Service {
	storageDir := filepath.Join(".", "data", "call-recordings")
	return &Service{
		repo:       repo,
		callLogs:   callLogs,
		users:      users,
		logger:     logger.With().Str("component", "recording_service").Logger(),
		asr:        newAliyunASRClient(asrCfg),
		llm:        newOpenRouterClient(llmCfg),
		storageDir: storageDir,
	}
}

// StartRecordingSession initializes a recording record for owner.
func (s *Service) StartRecordingSession(ctx context.Context, ownerID uint64, ownerEmail, callID, targetLang string) (*models.CallRecording, error) {
	if callID == "" {
		return nil, errors.New("call_id required")
	}
	if targetLang != "zh" && targetLang != "en" {
		return nil, errors.New("target_lang must be zh or en")
	}

	log, err := s.callLogs.GetByCallIDAndUserID(ctx, callID, ownerID)
	if err != nil {
		return nil, fmt.Errorf("call not found")
	}
	if log.Status != calllog.StatusAnswered {
		return nil, fmt.Errorf("call not answered")
	}

	if existing, err := s.repo.GetByCallIDAndOwner(ctx, callID, ownerID); err == nil {
		return existing, nil
	}

	record := &models.CallRecording{
		CallID:      callID,
		OwnerUserID: ownerID,
		OwnerEmail:  ownerEmail,
		PeerEmail:   log.PeerEmail,
		Status:      StatusRecording,
		TargetLang:  targetLang,
	}
	if err := s.repo.Create(ctx, record); err != nil {
		return nil, err
	}
	return record, nil
}

// SaveUpload saves an uploaded audio file and returns the path.
func (s *Service) SaveUpload(ctx context.Context, callID string, uploaderID uint64, uploaderEmail string, file *multipart.FileHeader, ext string, saveFn func(*multipart.FileHeader, string) error) (string, error) {
	_ = uploaderEmail
	if err := os.MkdirAll(s.storageDir, 0o755); err != nil {
		return "", err
	}
	rec, err := s.repo.GetByCallIDAndOwner(ctx, callID, uploaderID)
	if err != nil {
		return "", fmt.Errorf("recording not found")
	}

	filename := fmt.Sprintf("%s-owner-%d%s", callID, rec.OwnerUserID, ext)
	dst := filepath.Join(s.storageDir, filename)
	if err := saveFn(file, dst); err != nil {
		return "", err
	}
	return dst, nil
}

// HandleUpload attaches the audio file and triggers processing immediately (single-side recording).
func (s *Service) HandleUpload(ctx context.Context, callID string, uploaderID uint64, uploaderEmail string, path string) (string, error) {
	_ = uploaderEmail
	rec, err := s.repo.GetByCallIDAndOwner(ctx, callID, uploaderID)
	if err != nil {
		return "", fmt.Errorf("recording not found")
	}

	updates := map[string]interface{}{
		"owner_audio_path": path,
		"status":           StatusProcessing,
	}
	if err := s.repo.UpdateByID(ctx, rec.ID, updates); err != nil {
		return "", err
	}

	go s.processRecording(rec.ID)
	return StatusProcessing, nil
}

// GetRecordingForOwner returns details for the recording owner.
func (s *Service) GetRecordingForOwner(ctx context.Context, callID string, ownerID uint64) (*RecordingDetail, error) {
	rec, err := s.repo.GetByCallIDAndOwner(ctx, callID, ownerID)
	if err != nil {
		return nil, err
	}

	var transcript []TranscriptSegment
	if len(rec.TranscriptJSON) > 0 {
		_ = json.Unmarshal(rec.TranscriptJSON, &transcript)
	}

	return &RecordingDetail{
		CallID:               rec.CallID,
		Status:               rec.Status,
		TargetLang:           rec.TargetLang,
		Transcript:           transcript,
		SummaryText:          rec.SummaryText,
		TranslatedTranscript: rec.TranslatedTranscript,
		TranslatedSummary:    rec.TranslatedSummary,
		ErrorMessage:         rec.ErrorMessage,
	}, nil
}

// GetRecordingStatus returns recording status for call logs.
func (s *Service) GetRecordingStatus(ctx context.Context, callID string, ownerID uint64) (string, bool) {
	rec, err := s.repo.GetByCallIDAndOwner(ctx, callID, ownerID)
	if err != nil {
		return "", false
	}
	return rec.Status, true
}

func (s *Service) processRecording(recordID uint64) {
	ctx := context.Background()
	rec, err := s.repo.GetByID(ctx, recordID)
	if err != nil {
		s.logger.Warn().Err(err).Msg("failed to load recording")
		return
	}

	if rec.OwnerAudioPath == "" {
		s.logger.Warn().Msg("recording missing audio path")
		_ = s.repo.UpdateByID(ctx, recordID, map[string]interface{}{
			"status":        StatusFailed,
			"error_message": "missing audio uploads",
		})
		return
	}

	ownerWav, ownerCleanup, err := s.ensureWav(rec.OwnerAudioPath)
	if err != nil {
		s.failRecording(ctx, recordID, err)
		return
	}
	defer ownerCleanup()

	ownerSegs, err := s.asr.Recognize(ctx, ownerWav, defaultFormat, defaultSampleRate)
	if err != nil {
		s.failRecording(ctx, recordID, err)
		return
	}
	merged := segmentsFromASR(ownerSegs)
	merged = deduplicateSegments(merged, dedupWindowMs)
	transcriptBytes, _ := json.Marshal(merged)

	plainTranscript := buildTranscriptText(merged)
	sourceLang := detectTranscriptLang(plainTranscript)
	targetLang := targetLangFromSource(sourceLang, rec.TargetLang)
	summary, translatedTranscript, translatedSummary, err := s.llm.SummarizeAndTranslate(ctx, plainTranscript, targetLang)
	if err != nil {
		s.failRecording(ctx, recordID, err)
		return
	}

	if err := s.repo.UpdateByID(ctx, recordID, map[string]interface{}{
		"status":                StatusReady,
		"target_lang":           targetLang,
		"transcript_json":       transcriptBytes,
		"summary_text":          summary,
		"translated_transcript": translatedTranscript,
		"translated_summary":    translatedSummary,
		"error_message":         "",
	}); err != nil {
		s.logger.Warn().Err(err).Msg("failed to update recording result")
	}

	_ = os.Remove(rec.OwnerAudioPath)
}

func (s *Service) failRecording(ctx context.Context, recordID uint64, err error) {
	_ = s.repo.UpdateByID(ctx, recordID, map[string]interface{}{
		"status":        StatusFailed,
		"error_message": err.Error(),
	})
	s.logger.Warn().Err(err).Msg("recording processing failed")
}

func (s *Service) ensureWav(path string) (string, func(), error) {
	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".wav" {
		return path, func() {}, nil
	}
	output := strings.TrimSuffix(path, filepath.Ext(path)) + ".wav"
	cmd := exec.Command("ffmpeg", "-y", "-i", path, "-ac", "1", "-ar", strconv.Itoa(defaultSampleRate), output)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", func() {}, fmt.Errorf("ffmpeg convert failed: %v %s", err, stderr.String())
	}
	return output, func() { _ = os.Remove(output) }, nil
}

// mergeSegments merges segments by time and assigns speaker labels.
func mergeSegments(owner []asrSentence, peer []asrSentence) []TranscriptSegment {
	all := make([]TranscriptSegment, 0, len(owner)+len(peer))
	for _, s := range owner {
		all = append(all, TranscriptSegment{
			Speaker: "A",
			StartMs: s.BeginTime,
			EndMs:   s.EndTime,
			Text:    strings.TrimSpace(s.Text),
		})
	}
	for _, s := range peer {
		all = append(all, TranscriptSegment{
			Speaker: "B",
			StartMs: s.BeginTime,
			EndMs:   s.EndTime,
			Text:    strings.TrimSpace(s.Text),
		})
	}
	sort.Slice(all, func(i, j int) bool {
		return all[i].StartMs < all[j].StartMs
	})
	return all
}

func segmentsFromASR(items []asrSentence) []TranscriptSegment {
	segs := make([]TranscriptSegment, 0, len(items))
	for _, s := range items {
		segs = append(segs, TranscriptSegment{
			Speaker: "",
			StartMs: s.BeginTime,
			EndMs:   s.EndTime,
			Text:    strings.TrimSpace(s.Text),
		})
	}
	return segs
}

func buildTranscriptText(items []TranscriptSegment) string {
	var b strings.Builder
	for _, seg := range items {
		if seg.Text == "" {
			continue
		}
		if seg.Speaker != "" {
			fmt.Fprintf(&b, "%s [%d-%d]: %s\n", seg.Speaker, seg.StartMs, seg.EndMs, seg.Text)
			continue
		}
		fmt.Fprintf(&b, "[%d-%d]: %s\n", seg.StartMs, seg.EndMs, seg.Text)
	}
	return b.String()
}

func deduplicateSegments(items []TranscriptSegment, windowMs int64) []TranscriptSegment {
	if len(items) < 2 || windowMs <= 0 {
		return items
	}
	result := make([]TranscriptSegment, 0, len(items))
	last := items[0]
	lastNorm := normalizeForDedup(last.Text)
	result = append(result, last)
	for i := 1; i < len(items); i++ {
		current := items[i]
		currentNorm := normalizeForDedup(current.Text)
		if currentNorm != "" && currentNorm == lastNorm {
			if current.StartMs-last.StartMs <= windowMs {
				continue
			}
		}
		result = append(result, current)
		last = current
		lastNorm = currentNorm
	}
	return result
}

func normalizeForDedup(text string) string {
	if text == "" {
		return ""
	}
	trimmed := strings.TrimSpace(text)
	trimmed = strings.ToLower(trimmed)
	var builder strings.Builder
	builder.Grow(len(trimmed))
	for _, r := range trimmed {
		if unicode.IsSpace(r) || unicode.IsPunct(r) {
			continue
		}
		builder.WriteRune(r)
	}
	return builder.String()
}

func detectTranscriptLang(text string) string {
	if text == "" {
		return ""
	}
	var cjkCount int
	var latinCount int
	for _, r := range text {
		if unicode.Is(unicode.Han, r) {
			cjkCount++
			continue
		}
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			latinCount++
		}
	}
	if cjkCount == 0 && latinCount == 0 {
		return ""
	}
	if cjkCount >= latinCount {
		return "zh"
	}
	return "en"
}

func targetLangFromSource(sourceLang string, fallback string) string {
	switch sourceLang {
	case "zh":
		return "en"
	case "en":
		return "zh"
	default:
		if fallback == "zh" || fallback == "en" {
			return fallback
		}
		return "en"
	}
}

// --- Aliyun ASR client ---

type aliyunASRClient struct {
	accessKeyID     string
	accessKeySecret string
	appKey          string
	region          string
	endpoint        string
	httpClient      *http.Client
}

func newAliyunASRClient(cfg config.ASRConfig) *aliyunASRClient {
	return &aliyunASRClient{
		accessKeyID:     cfg.AccessKeyID,
		accessKeySecret: cfg.AccessKeySecret,
		appKey:          cfg.AppKey,
		region:          cfg.Region,
		endpoint:        cfg.Endpoint,
		httpClient:      &http.Client{Timeout: 60 * time.Second},
	}
}

type asrSentence struct {
	Text      string `json:"text"`
	BeginTime int64  `json:"begin_time"`
	EndTime   int64  `json:"end_time"`
}

func (c *aliyunASRClient) Recognize(ctx context.Context, path string, format string, sampleRate int) ([]asrSentence, error) {
	if c.accessKeyID == "" || c.accessKeySecret == "" || c.appKey == "" {
		return nil, errors.New("aliyun asr credentials not configured")
	}
	token, err := c.getToken(ctx)
	if err != nil {
		return nil, err
	}

	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	q := url.Values{}
	q.Set("appkey", c.appKey)
	q.Set("token", token)
	q.Set("format", format)
	q.Set("sample_rate", strconv.Itoa(sampleRate))
	reqURL := fmt.Sprintf("%s/stream/v1/FlashRecognizer?%s", strings.TrimRight(c.endpoint, "/"), q.Encode())

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, file)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/octet-stream")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("asr request failed: %s", string(body))
	}

	var parsed struct {
		FlashResult struct {
			Sentences []asrSentence `json:"sentences"`
		} `json:"flash_result"`
		// 阿里云返回的 status 可能是数字或字符串，避免类型不匹配导致解码失败
		Status any `json:"status"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, err
	}
	return parsed.FlashResult.Sentences, nil
}

func (c *aliyunASRClient) getToken(ctx context.Context) (string, error) {
	endpoint := fmt.Sprintf("https://nls-meta.%s.aliyuncs.com", c.region)
	params := map[string]string{
		"AccessKeyId":      c.accessKeyID,
		"Action":           "CreateToken",
		"Format":           "JSON",
		"RegionId":         c.region,
		"SignatureMethod":  "HMAC-SHA1",
		"SignatureNonce":   fmt.Sprintf("%d", time.Now().UnixNano()),
		"SignatureVersion": "1.0",
		"Timestamp":        time.Now().UTC().Format("2006-01-02T15:04:05Z"),
		"Version":          "2019-02-28",
	}

	signature := signAliyunRPC(params, c.accessKeySecret)
	params["Signature"] = signature

	query := buildQuery(params)
	reqURL := endpoint + "/?" + query
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return "", err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var parsed struct {
		Token struct {
			ID string `json:"Id"`
		} `json:"Token"`
		Message   string `json:"Message"`
		ErrorCode string `json:"ErrorCode"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", err
	}
	if parsed.ErrorCode != "" {
		return "", fmt.Errorf("aliyun token error: %s", parsed.Message)
	}
	if parsed.Token.ID == "" {
		return "", fmt.Errorf("aliyun token missing")
	}
	return parsed.Token.ID, nil
}

func signAliyunRPC(params map[string]string, secret string) string {
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var canonical strings.Builder
	for i, k := range keys {
		if i > 0 {
			canonical.WriteString("&")
		}
		canonical.WriteString(percentEncode(k))
		canonical.WriteString("=")
		canonical.WriteString(percentEncode(params[k]))
	}
	stringToSign := "GET&%2F&" + percentEncode(canonical.String())

	mac := hmac.New(sha1.New, []byte(secret+"&"))
	_, _ = mac.Write([]byte(stringToSign))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func percentEncode(value string) string {
	encoded := url.QueryEscape(value)
	encoded = strings.ReplaceAll(encoded, "+", "%20")
	encoded = strings.ReplaceAll(encoded, "*", "%2A")
	encoded = strings.ReplaceAll(encoded, "%7E", "~")
	return encoded
}

func buildQuery(params map[string]string) string {
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var parts []string
	for _, k := range keys {
		parts = append(parts, percentEncode(k)+"="+percentEncode(params[k]))
	}
	return strings.Join(parts, "&")
}

// --- OpenRouter client ---

type openRouterClient struct {
	apiKey  string
	baseURL string
	model   string
	client  *http.Client
}

func newOpenRouterClient(cfg config.OpenRouterConfig) *openRouterClient {
	return &openRouterClient{
		apiKey:  cfg.APIKey,
		baseURL: cfg.BaseURL,
		model:   cfg.Model,
		client:  &http.Client{Timeout: 90 * time.Second},
	}
}

func (c *openRouterClient) SummarizeAndTranslate(ctx context.Context, transcript string, targetLang string) (string, string, string, error) {
	if c.apiKey == "" {
		return "", "", "", errors.New("openrouter api key not configured")
	}

	targetLabel := "English"
	if targetLang == "zh" {
		targetLabel = "中文"
	}

	systemPrompt := "You are a helpful assistant. Given a two-person phone call transcript captured from a single device (speaker identities are unknown), return ONLY valid JSON with keys: summary, translated_transcript, translated_summary. Do NOT assign speakers or add labels like A/B. Values MUST be plain strings (not arrays or objects). summary should be in the original language. translated_* must be in target language."
	userPrompt := fmt.Sprintf("Translate target language: %s (opposite of source language).\nTranscript (single stream, no speaker identities):\n%s", targetLabel, transcript)

	payload := map[string]interface{}{
		"model": c.model,
		"messages": []map[string]string{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": userPrompt},
		},
	}
	bodyBytes, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(c.baseURL, "/")+"/chat/completions", bytes.NewReader(bodyBytes))
	if err != nil {
		return "", "", "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return "", "", "", err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", "", "", fmt.Errorf("openrouter error: %s", string(respBody))
	}

	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return "", "", "", err
	}
	if len(parsed.Choices) == 0 {
		return "", "", "", fmt.Errorf("openrouter empty response")
	}

	content := parsed.Choices[0].Message.Content
	jsonPart := extractJSON(content)
	if strings.TrimSpace(jsonPart) == "{}" {
		jsonPart = strings.TrimSpace(content)
	}

	var result map[string]json.RawMessage
	if err := json.Unmarshal([]byte(jsonPart), &result); err != nil {
		// 降级处理：无法解析 JSON 时，把原始内容当作摘要
		return strings.TrimSpace(content), "", "", nil
	}

	summary := normalizeJSONField(result["summary"])
	translatedTranscript := normalizeJSONField(result["translated_transcript"])
	translatedSummary := normalizeJSONField(result["translated_summary"])

	if summary == "" && translatedTranscript == "" && translatedSummary == "" {
		return "", "", "", errors.New("openrouter empty response")
	}

	return summary, translatedTranscript, translatedSummary, nil
}

func extractJSON(input string) string {
	start := strings.Index(input, "{")
	end := strings.LastIndex(input, "}")
	if start == -1 || end == -1 || end <= start {
		return "{}"
	}
	return input[start : end+1]
}

func normalizeJSONField(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	rawStr := strings.TrimSpace(string(raw))
	if rawStr == "" || rawStr == "null" {
		return ""
	}

	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return strings.TrimSpace(s)
	}

	var arr []any
	if err := json.Unmarshal(raw, &arr); err == nil {
		return joinAnyLines(arr)
	}

	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err == nil {
		return stringifyAny(obj)
	}

	return rawStr
}

func joinAnyLines(items []any) string {
	lines := make([]string, 0, len(items))
	for _, item := range items {
		line := stringifyAny(item)
		if strings.TrimSpace(line) != "" {
			lines = append(lines, line)
		}
	}
	return strings.Join(lines, "\n")
}

func stringifyAny(v any) string {
	switch val := v.(type) {
	case string:
		return strings.TrimSpace(val)
	case []any:
		return joinAnyLines(val)
	case map[string]any:
		if speaker, ok := val["speaker"]; ok {
			if text, okText := val["text"]; okText {
				return fmt.Sprintf("%s: %s", stringifyAny(speaker), stringifyAny(text))
			}
		}
		if text, ok := val["text"]; ok {
			return stringifyAny(text)
		}
		if content, ok := val["content"]; ok {
			return stringifyAny(content)
		}
		if transcript, ok := val["transcript"]; ok {
			return stringifyAny(transcript)
		}
		if lines, ok := val["lines"]; ok {
			return stringifyAny(lines)
		}
		if summary, ok := val["summary"]; ok {
			return stringifyAny(summary)
		}
		if translated, ok := val["translated_transcript"]; ok {
			return stringifyAny(translated)
		}
		b, err := json.Marshal(val)
		if err != nil {
			return ""
		}
		return string(b)
	default:
		return strings.TrimSpace(fmt.Sprint(val))
	}
}
