
export type GradeLevel = 'Elementary (K-5)' | 'Middle School (6-8)' | 'High School (9-12)';

export interface Subject {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export interface SessionConfig {
  grade: GradeLevel;
  subject: Subject;
}
