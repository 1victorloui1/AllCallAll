// 认证处理器：处理注册/登录并签发 JWT
package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog"

	"github.com/allcallall/backend/internal/auth"
	"github.com/allcallall/backend/internal/models"
	"github.com/allcallall/backend/internal/user"
)

// AuthHandler 认证处理器
// AuthHandler exposes registration and login endpoints.
type AuthHandler struct {
	logger     zerolog.Logger
	users      *user.Service
	jwtManager *auth.Manager
}

// NewAuthHandler 构造函数
// NewAuthHandler creates an AuthHandler.
func NewAuthHandler(log zerolog.Logger, users *user.Service, jwt *auth.Manager) *AuthHandler {
	return &AuthHandler{
		logger:     log.With().Str("component", "auth_handler").Logger(),
		users:      users,
		jwtManager: jwt,
	}
}

// 注册请求体
type registerRequest struct {
	Email       string `json:"email" binding:"required,email"`
	Password    string `json:"password" binding:"required,min=8"`
	DisplayName string `json:"display_name" binding:"required"`
}

// 登录/注册统一响应体
type authResponse struct {
	User        userDTO `json:"user"`
	AccessToken string  `json:"access_token"`
}

// 登录请求体
type loginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

// 返回给前端的用户结构
type userDTO struct {
	ID          uint64 `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
}

// 内部模型 -> 前端 DTO
func toUserDTO(u *models.User) userDTO {
	return userDTO{
		ID:          u.ID,
		Email:       u.Email,
		DisplayName: u.DisplayName,
	}
}

// RegisterRoutes 注册路由
// RegisterRoutes attaches auth routes.
func (h *AuthHandler) RegisterRoutes(rg *gin.RouterGroup) {
	rg.POST("/register", h.handleRegister)
	rg.POST("/login", h.handleLogin)
}

// handleRegister 处理注册请求
func (h *AuthHandler) handleRegister(c *gin.Context) {
	// 解析并校验请求体
	var req registerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		JSONError(c, http.StatusBadRequest, err.Error())
		return
	}

	// 调用用户服务完成注册
	userModel, err := h.users.Register(c.Request.Context(), user.RegisterInput{
		Email:       req.Email,
		Password:    req.Password,
		DisplayName: req.DisplayName,
	})
	if err != nil {
		switch err {
		case user.ErrEmailAlreadyUsed:
			JSONError(c, http.StatusConflict, "email already registered")
		default:
			h.logger.Error().Err(err).Msg("register failed")
			JSONError(c, http.StatusInternalServerError, "failed to register")
		}
		return
	}

	// 注册成功后签发 JWT
	token, err := h.jwtManager.GenerateAccessToken(userModel.ID, userModel.Email)
	if err != nil {
		h.logger.Error().Err(err).Msg("generate token failed")
		JSONError(c, http.StatusInternalServerError, "failed to generate token")
		return
	}

	// 返回用户信息与 token
	JSONSuccess(c, http.StatusCreated, authResponse{
		User:        toUserDTO(userModel),
		AccessToken: token,
	})
}

// handleLogin 处理登录请求
func (h *AuthHandler) handleLogin(c *gin.Context) {
	// 解析并校验请求体
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		JSONError(c, http.StatusBadRequest, err.Error())
		return
	}

	// 校验账号密码
	userModel, err := h.users.Authenticate(c.Request.Context(), user.LoginInput{
		Email:    req.Email,
		Password: req.Password,
	})
	if err != nil {
		if err == user.ErrInvalidCredentials {
			JSONError(c, http.StatusUnauthorized, "invalid credentials")
			return
		}
		h.logger.Error().Err(err).Msg("login failed")
		JSONError(c, http.StatusInternalServerError, "failed to login")
		return
	}

	// 登录成功后签发 JWT
	token, err := h.jwtManager.GenerateAccessToken(userModel.ID, userModel.Email)
	if err != nil {
		h.logger.Error().Err(err).Msg("generate token failed")
		JSONError(c, http.StatusInternalServerError, "failed to generate token")
		return
	}

	// 返回用户信息与 token
	JSONSuccess(c, http.StatusOK, authResponse{
		User:        toUserDTO(userModel),
		AccessToken: token,
	})
}
