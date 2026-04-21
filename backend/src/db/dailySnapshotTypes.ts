export type DailySnapshotInput = {
  likes: number | null
  mutual: number | null
  following: number | null
  followers: number | null
  parsed: boolean
}

export type DailySnapshotRow = {
  snapshot_date: string
  likes: number | null
  mutual: number | null
  following: number | null
  followers: number | null
  parsed: boolean
}
