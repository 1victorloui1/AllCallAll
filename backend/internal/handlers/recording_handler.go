package handlers

import (
	"fmt"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog"

	"github.com/allcallall/backend/internal/auth"
	"github.com/allcallall/backend/internal/recording"
)

// RecordingHandler handles call recording endpoints.
// RecordingHandler 处理通话录音与摘要接口。
type RecordingHandler struct {
	logger  zerolog.Logger
	service *recording.Service
}

// NewRecordingHandler creates a RecordingHandler.
func NewRecordingHandler(log zerolog.Logger, service *recording.Service) *RecordingHandler {
	return &RecordingHandler{
		logger:  log.With().Str("component", "recording_handler").Logger(),
		service: service,
	}
}

// RegisterRoutes registers recording routes.
func (h *RecordingHandler) RegisterRoutes(rg *gin.RouterGroup) {
	rg.POST("/call-recordings/start", h.handleStart)
	rg.POST("/call-recordings/:call_id/upload", h.handleUpload)
	rg.GET("/call-recordings/:call_id", h.handleGet)
}

// handleStart creates a recording session for the caller.
func (h *RecordingHandler) handleStart(c *gin.Context) {
	claims, err := auth.GetClaimsFromContext(c)
	if err != nil {
		JSONError(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req struct {
		CallID     string `json:"call_id"`
		TargetLang string `json:"target_lang"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		JSONError(c, http.StatusBadRequest, err.Error())
		return
	}
	req.CallID = strings.TrimSpace(req.CallID)
	if req.CallID == "" {
		JSONError(c, http.StatusBadRequest, "call_id required")
		return
	}
	if req.TargetLang == "" {
		req.TargetLang = "zh"
	}

	recording, err := h.service.StartRecordingSession(
		c.Request.Context(),
		claims.UserID,
		claims.Email,
		req.CallID,
		req.TargetLang,
	)
	if err != nil {
		h.logger.Error().Err(err).Msg("start recording failed")
		JSONError(c, http.StatusBadRequest, err.Error())
		return
	}

	JSONSuccess(c, http.StatusOK, gin.H{
		"call_id": recording.CallID,
		"status":  recording.Status,
	})
}

// handleUpload receives audio upload from a participant.
func (h *RecordingHandler) handleUpload(c *gin.Context) {
	claims, err := auth.GetClaimsFromContext(c)
	if err != nil {
		JSONError(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	callID := strings.TrimSpace(c.Param("call_id"))
	if callID == "" {
		JSONError(c, http.StatusBadRequest, "call_id required")
		return
	}

	file, err := c.FormFile("audio")
	if err != nil {
		h.logger.Error().
			Err(err).
			Str("content_type", c.ContentType()).
			Str("content_length", c.GetHeader("Content-Length")).
			Msg("audio upload missing or invalid")
		JSONError(c, http.StatusBadRequest, "audio file required")
		return
	}

	h.logger.Info().
		Str("call_id", callID).
		Str("uploader", claims.Email).
		Str("filename", file.Filename).
		Int64("size", file.Size).
		Msg("audio upload received")

	ext := strings.ToLower(filepath.Ext(file.Filename))
	if ext == "" {
		ext = ".m4a"
	}

	path, err := h.service.SaveUpload(c.Request.Context(), callID, claims.UserID, claims.Email, file, ext, c.SaveUploadedFile)
	if err != nil {
		h.logger.Error().Err(err).Msg("save upload failed")
		JSONError(c, http.StatusBadRequest, err.Error())
		return
	}

	status, err := h.service.HandleUpload(c.Request.Context(), callID, claims.UserID, claims.Email, path)
	if err != nil {
		h.logger.Error().Err(err).Msg("handle upload failed")
		JSONError(c, http.StatusBadRequest, err.Error())
		return
	}

	JSONSuccess(c, http.StatusOK, gin.H{
		"call_id": callID,
		"status":  status,
	})
}

// handleGet returns recording details for owner.
func (h *RecordingHandler) handleGet(c *gin.Context) {
	claims, err := auth.GetClaimsFromContext(c)
	if err != nil {
		JSONError(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	callID := strings.TrimSpace(c.Param("call_id"))
	if callID == "" {
		JSONError(c, http.StatusBadRequest, "call_id required")
		return
	}

	result, err := h.service.GetRecordingForOwner(c.Request.Context(), callID, claims.UserID)
	if err != nil {
		h.logger.Error().Err(err).Msg("get recording failed")
		JSONError(c, http.StatusNotFound, fmt.Sprintf("recording not found: %v", err))
		return
	}

	JSONSuccess(c, http.StatusOK, gin.H{"recording": result})
}
