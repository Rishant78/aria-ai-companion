export interface CompanionResponsePayload {
  session_id: string;
  response_text: string;
  emotion: string;
  emotion_intensity: number;
  gesture?: string | null;
  gesture_intensity: number;
  speech_intent: string;
  mouth_animation_profile: string;
  created_at: string;
  audio_data?: string | null;
  audio_mime_type?: string | null;
  audio_duration?: number | null;
  audio_sample_rate?: number | null;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'companion';
  text: string;
  timestamp: number;
  emotion?: string;
  gesture?: string | null;
  speechIntent?: string;
  isError?: boolean;
  audioData?: string | null;
  audioMimeType?: string | null;
  audioDuration?: number | null;
}

export interface ActiveDialogueState {
  id: string;
  fullText: string;
  displayedText: string;
  emotion?: string;
  gesture?: string | null;
  speechIntent?: string;
  isSpeaking: boolean;
  progress: number;
  completedAt?: number;
  audioData?: string | null;
  audioMimeType?: string | null;
  audioDuration?: number | null;
}

export type ChatStatusKind = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
