package chatlog

import (
	"context"

	"gorm.io/gorm"

	"github.com/allcallall/backend/internal/models"
)

// Repository manages chat message persistence.
type Repository struct {
	db *gorm.DB
}

// NewRepository constructs a Repository.
func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// Create inserts a chat message.
func (r *Repository) Create(ctx context.Context, message *models.ChatMessage) error {
	return r.db.WithContext(ctx).Create(message).Error
}

// ListBetween returns messages between two users.
func (r *Repository) ListBetween(ctx context.Context, userID, peerID uint64, limit int) ([]models.ChatMessage, error) {
	if limit <= 0 {
		limit = 50
	}

	var messages []models.ChatMessage
	err := r.db.WithContext(ctx).
		Where(
			"(sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)",
			userID, peerID, peerID, userID,
		).
		Order("sent_at desc").
		Limit(limit).
		Find(&messages).
		Error
	return messages, err
}
