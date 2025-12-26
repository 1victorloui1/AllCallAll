package calllog

import (
	"context"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/allcallall/backend/internal/models"
)

// Repository manages call log persistence.
type Repository struct {
	db *gorm.DB
}

// NewRepository constructs a Repository.
func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// CreateMany inserts call logs with idempotency.
func (r *Repository) CreateMany(ctx context.Context, records []*models.CallLog) error {
	if len(records) == 0 {
		return nil
	}
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&records).
		Error
}

// ListByUserID returns recent call logs for a user.
func (r *Repository) ListByUserID(ctx context.Context, userID uint64, limit int) ([]models.CallLog, error) {
	if limit <= 0 {
		limit = 50
	}

	var logs []models.CallLog
	err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("started_at desc").
		Limit(limit).
		Find(&logs).
		Error
	return logs, err
}

// UpdateByCallID updates call logs by call ID.
func (r *Repository) UpdateByCallID(ctx context.Context, callID string, updates map[string]interface{}) error {
	return r.db.WithContext(ctx).
		Model(&models.CallLog{}).
		Where("call_id = ?", callID).
		Updates(updates).
		Error
}

// UpdateByCallIDAndStatus updates call logs by call ID and status.
func (r *Repository) UpdateByCallIDAndStatus(ctx context.Context, callID, status string, updates map[string]interface{}) error {
	return r.db.WithContext(ctx).
		Model(&models.CallLog{}).
		Where("call_id = ? AND status = ?", callID, status).
		Updates(updates).
		Error
}
