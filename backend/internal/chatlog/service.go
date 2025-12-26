package chatlog

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/rs/zerolog"

	"github.com/allcallall/backend/internal/models"
	"github.com/allcallall/backend/internal/user"
)

// Service provides chat log operations.
type Service struct {
	repo   *Repository
	users  *user.Service
	logger zerolog.Logger
}

// NewService constructs a Service.
func NewService(repo *Repository, users *user.Service, logger zerolog.Logger) *Service {
	return &Service{
		repo:   repo,
		users:  users,
		logger: logger.With().Str("component", "chat_log_service").Logger(),
	}
}

// RecordMessage persists a chat message between two users.
func (s *Service) RecordMessage(ctx context.Context, fromEmail, toEmail, body string, sentAt time.Time) error {
	fromEmail = strings.TrimSpace(fromEmail)
	toEmail = strings.TrimSpace(toEmail)
	body = strings.TrimSpace(body)

	if fromEmail == "" || toEmail == "" {
		return fmt.Errorf("sender and receiver are required")
	}
	if body == "" {
		return fmt.Errorf("message body is required")
	}
	if sentAt.IsZero() {
		sentAt = time.Now()
	}

	sender, err := s.users.GetByEmail(ctx, fromEmail)
	if err != nil {
		return fmt.Errorf("load sender: %w", err)
	}
	receiver, err := s.users.GetByEmail(ctx, toEmail)
	if err != nil {
		return fmt.Errorf("load receiver: %w", err)
	}

	message := &models.ChatMessage{
		SenderID:            sender.ID,
		SenderEmail:         sender.Email,
		SenderDisplayName:   sender.DisplayName,
		ReceiverID:          receiver.ID,
		ReceiverEmail:       receiver.Email,
		ReceiverDisplayName: receiver.DisplayName,
		Body:                body,
		SentAt:              sentAt,
	}

	return s.repo.Create(ctx, message)
}

// ListConversation returns recent chat messages with a peer.
func (s *Service) ListConversation(ctx context.Context, userID uint64, peerEmail string, limit int) ([]models.ChatMessage, error) {
	peerEmail = strings.TrimSpace(peerEmail)
	if peerEmail == "" {
		return nil, fmt.Errorf("peer email required")
	}

	peer, err := s.users.GetByEmail(ctx, peerEmail)
	if err != nil {
		return nil, fmt.Errorf("load peer: %w", err)
	}

	return s.repo.ListBetween(ctx, userID, peer.ID, limit)
}
