export function deriveProviderRoomName(voiceRoomId: string): string {
  if (!voiceRoomId) throw new Error('voice room id is required')
  return `sidebar:voice:${voiceRoomId}`
}
