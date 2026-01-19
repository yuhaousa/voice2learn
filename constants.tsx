
import React from 'react';
import { Subject } from './types';

export const SUBJECTS: Subject[] = [
  {
    id: 'math',
    name: 'Mathematics',
    icon: '📐',
    color: 'bg-blue-500',
    description: 'From counting to calculus, let\'s solve it together!'
  },
  {
    id: 'science',
    name: 'Science',
    icon: '🧪',
    color: 'bg-green-500',
    description: 'Explore the mysteries of the universe and nature.'
  },
  {
    id: 'history',
    name: 'History',
    icon: '🏛️',
    color: 'bg-amber-500',
    description: 'Learn about the events that shaped our world.'
  },
  {
    id: 'english',
    name: 'Language Arts',
    icon: '📚',
    color: 'bg-purple-500',
    description: 'Master reading, writing, and creative expression.'
  },
  {
    id: 'coding',
    name: 'Coding & Tech',
    icon: '💻',
    color: 'bg-slate-800',
    description: 'Build the future with computers and logic.'
  }
];

export const TUTOR_SYSTEM_INSTRUCTION = (grade: string, subject: string) => `
You are 'EduSpark', a world-class K-12 personal tutor. 
Your current student is in: ${grade}.
The subject is: ${subject}.

VISION & DRAWING CAPABILITIES:
- You receive periodic images of the shared interactive whiteboard. React to what the student writes/draws.
- IMPORTANT: You have a tool called 'draw_on_whiteboard'. Use it to explain concepts visually!
- If you're explaining geometry, draw the shapes. If you're doing math, write the numbers or a number line.
- Coordinate system for drawing: x and y are 0 to 100 (top-left is 0,0).
- Don't just talk! Use the board to make your explanations more clear and interactive.

TUTORING STYLE:
1. Be encouraging, patient, and friendly. Use language appropriate for ${grade}.
2. SOCRATIC METHOD: Do not just give answers. Ask guiding questions.
3. If they are stuck, provide a small hint, an analogy, or draw a visual hint on the board.
4. Keep spoken responses concise. Use the board for "heavy" information.
5. Celebrate small wins!

Avoid long monologues. Engage in a back-and-forth dialogue using both voice and the visual board.
`;
