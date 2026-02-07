package recording

import (
	"context"

	"gorm.io/gorm"

	"github.com/allcallall/backend/internal/models"
)

// Repository manages call recording persistence.
// Repository 负责通话录音记录的读写。
type Repository struct {
	db *gorm.DB
}

// NewRepository constructs a Repository.
func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// Create inserts a new recording session.
func (r *Repository) Create(ctx context.Context, rec *models.CallRecording) error {
	return r.db.WithContext(ctx).Create(rec).Error
}

// GetByCallIDAndOwner returns a recording for an owner.
func (r *Repository) GetByCallIDAndOwner(ctx context.Context, callID string, ownerID uint64) (*models.CallRecording, error) {
	var rec models.CallRecording
	if err := r.db.WithContext(ctx).
		Where("call_id = ? AND owner_user_id = ?", callID, ownerID).
		Take(&rec).
		Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

// UpdateByID updates a recording by ID.
func (r *Repository) UpdateByID(ctx context.Context, id uint64, updates map[string]interface{}) error {
	return r.db.WithContext(ctx).
		Model(&models.CallRecording{}).
		Where("id = ?", id).
		Updates(updates).
		Error
}

// MarkProcessingIfReady switches status to processing if not already processing/ready.
func (r *Repository) MarkProcessingIfReady(ctx context.Context, id uint64) (bool, error) {
	result := r.db.WithContext(ctx).
		Model(&models.CallRecording{}).
		Where("id = ? AND status NOT IN ?", id, []string{StatusProcessing, StatusReady}).
		Update("status", StatusProcessing)
	return result.RowsAffected > 0, result.Error
}

// GetByID returns a recording by ID.
func (r *Repository) GetByID(ctx context.Context, id uint64) (*models.CallRecording, error) {
	var rec models.CallRecording
	if err := r.db.WithContext(ctx).
		Where("id = ?", id).
		Take(&rec).
		Error; err != nil {
		return nil, err
	}
	return &rec, nil
}
