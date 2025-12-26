package calllog

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog"

	"github.com/allcallall/backend/internal/models"
	"github.com/allcallall/backend/internal/user"
)

const (
	DirectionOutgoing = "outgoing"
	DirectionIncoming = "incoming"

	StatusPending  = "pending"
	StatusAnswered = "answered"
	StatusMissed   = "missed"
)

// Service provides call log operations.
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
		logger: logger.With().Str("component", "call_log_service").Logger(),
	}
}

// RecordInvite stores initial call log entries for both parties.
func (s *Service) RecordInvite(ctx context.Context, callID, fromEmail, toEmail string) error {
	if callID == "" {
		return fmt.Errorf("call_id required")
	}

	caller, err := s.users.GetByEmail(ctx, fromEmail)
	if err != nil {
		return fmt.Errorf("load caller: %w", err)
	}
	callee, err := s.users.GetByEmail(ctx, toEmail)
	if err != nil {
		return fmt.Errorf("load callee: %w", err)
	}

	now := time.Now()
	records := []*models.CallLog{
		{
			CallID:          callID,
			UserID:          caller.ID,
			UserEmail:       caller.Email,
			PeerID:          callee.ID,
			PeerEmail:       callee.Email,
			PeerDisplayName: callee.DisplayName,
			Direction:       DirectionOutgoing,
			Status:          StatusPending,
			StartedAt:       now,
		},
		{
			CallID:          callID,
			UserID:          callee.ID,
			UserEmail:       callee.Email,
			PeerID:          caller.ID,
			PeerEmail:       caller.Email,
			PeerDisplayName: caller.DisplayName,
			Direction:       DirectionIncoming,
			Status:          StatusPending,
			StartedAt:       now,
		},
	}

	return s.repo.CreateMany(ctx, records)
}

// RecordAccept marks call logs as answered.
func (s *Service) RecordAccept(ctx context.Context, callID string) error {
	if callID == "" {
		return fmt.Errorf("call_id required")
	}

	now := time.Now()
	return s.repo.UpdateByCallIDAndStatus(ctx, callID, StatusPending, map[string]interface{}{
		"status":      StatusAnswered,
		"answered_at": &now,
	})
}

// RecordEnd marks pending calls as missed and sets end time for all records.
func (s *Service) RecordEnd(ctx context.Context, callID string) error {
	if callID == "" {
		return fmt.Errorf("call_id required")
	}

	now := time.Now()
	if err := s.repo.UpdateByCallIDAndStatus(ctx, callID, StatusPending, map[string]interface{}{
		"status":   StatusMissed,
		"ended_at": &now,
	}); err != nil {
		return err
	}

	return s.repo.UpdateByCallID(ctx, callID, map[string]interface{}{
		"ended_at": &now,
	})
}

// List returns call logs for a user.
func (s *Service) List(ctx context.Context, userID uint64, limit int) ([]models.CallLog, error) {
	return s.repo.ListByUserID(ctx, userID, limit)
}
