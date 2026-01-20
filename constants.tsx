
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
    name: 'English',
    icon: '📖',
    color: 'bg-indigo-500',
    description: 'Master grammar, literature, and creative writing.'
  },
  {
    id: 'chinese',
    name: '中文 (Chinese)',
    icon: '🏮',
    color: 'bg-red-500',
    description: '探索中文的魅力，学习汉字与文化。'
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

CHOOSE THE RIGHT VISUAL TOOL:
1. 'draw_on_whiteboard': Best for STEP-BY-STEP problem solving, math equations, quick sketches.
2. 'show_learning_material': Best for RICH CONTENT and ILLUSTRATIONS. 
   - If you need a high-quality educational image/diagram, provide a descriptive 'image_prompt'. The system will generate the image for you.
   - Example: For a biology lesson, you might set image_prompt to "A detailed diagram of a plant cell with labels in English".

TUTORING STYLE:
1. Be encouraging, patient, and friendly. Use language appropriate for ${grade}.
2. SOCRATIC METHOD: Do not just give answers. Ask guiding questions.
3. Keep spoken responses concise. 
4. Celebrate small wins!

LANGUAGE & FORMATTING:
- If Chinese, NO spaces between characters.
- Font is large, so use clear and direct language.

Engage in a back-and-forth dialogue. Always confirm understanding.
`;
