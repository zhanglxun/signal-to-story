type AuthErrorLike = {
  code?: string
  status?: number
}

export function getAuthErrorMessage(error: unknown, fallback: string) {
  const authError = error as AuthErrorLike | null

  if (authError?.status === 429) {
    return "请求过于频繁，请稍后再试。"
  }

  switch (authError?.code) {
    case "invalid_credentials":
      return "邮箱或密码不正确。"
    case "email_not_confirmed":
      return "邮箱尚未验证，请先完成邮箱验证。"
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "请求过于频繁，请稍后再试。"
    case "same_password":
      return "新密码不能与当前密码相同。"
    case "weak_password":
      return "新密码强度不足，请使用至少 8 位且更难猜测的密码。"
    case "session_not_found":
      return "登录状态已失效，请重新登录。"
    default:
      return fallback
  }
}
