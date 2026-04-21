export type UserRow = {
  id: number
  username: string
  password_hash: string
  role: string
  created_at: number
}

export type DouyinBindingRow = {
  session_id: string
  nickname: string | null
  douyin_id: string | null
  avatar_url: string | null
  updated_at: number
}
