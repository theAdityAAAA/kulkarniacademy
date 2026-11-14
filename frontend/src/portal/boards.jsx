import React from 'react';

// Exam boards and the years/grades that go with each one. Used by the dropdowns on the teacher's
// "Add a student" / "Edit details" forms and on the student's "Your board and year" card.
// `board` must match the "board" field in frontend/public/curricula/*.json so the right syllabi are suggested.
const uk = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `Year ${from + i} / Grade ${from + i - 1}`);

export const BOARDS = [
  { board: 'Cambridge IGCSE', grades: uk(9, 11) },
  { board: 'Edexcel International GCSE', grades: uk(9, 11) },
  { board: 'GCSE (UK)', grades: ['Year 9', 'Year 10', 'Year 11'] },
  { board: 'Cambridge AS & A Level', grades: ['Year 12 / Grade 11 (AS Level)', 'Year 13 / Grade 12 (A Level)'] },
  { board: 'IB Diploma (DP)', grades: ['DP1 (Grade 11)', 'DP2 (Grade 12)'] },
  { board: 'IB MYP', grades: ['MYP 1 (Grade 6)', 'MYP 2 (Grade 7)', 'MYP 3 (Grade 8)', 'MYP 4 (Grade 9)', 'MYP 5 (Grade 10)'] },
  { board: 'Cambridge Lower Secondary', grades: ['Stage 7 (Year 7 / Grade 6)', 'Stage 8 (Year 8 / Grade 7)', 'Stage 9 (Year 9 / Grade 8)'] },
  { board: 'US Common Core', grades: ['Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'] },
  { board: 'Singapore O-Level', grades: ['Secondary 1', 'Secondary 2', 'Secondary 3', 'Secondary 4'] },
  { board: 'Other', grades: uk(5, 13) },
];

export const gradesFor = (board) => BOARDS.find((b) => b.board === board)?.grades ?? BOARDS.at(-1).grades;

/** Board + year dropdowns. Keeps an older typed-in value visible so saving never silently wipes it. */
export function BoardGradeFields({ board, grade, onChange, required = false }) {
  const grades = gradesFor(board);
  const knownBoard = !board || BOARDS.some((b) => b.board === board);
  const knownGrade = !grade || grades.includes(grade);
  const pickBoard = (event) => {
    const next = event.target.value;
    // Keep the year if it also exists on the new board; otherwise ask again.
    onChange({ board: next, grade: gradesFor(next).includes(grade) ? grade : '' });
  };
  return <div className="grid-2">
    <label>Board{!required && <span className="optional"> (optional)</span>}
      <select value={board} onChange={pickBoard} required={required}>
        <option value="">Choose a board…</option>
        {!knownBoard && <option value={board}>{board} (typed earlier)</option>}
        {BOARDS.map((b) => <option key={b.board} value={b.board}>{b.board}</option>)}
      </select>
    </label>
    <label>Year / grade{!required && <span className="optional"> (optional)</span>}
      <select value={grade} onChange={(e) => onChange({ board, grade: e.target.value })} required={required}>
        <option value="">{board ? 'Choose a year…' : 'Choose the board first…'}</option>
        {!knownGrade && <option value={grade}>{grade} (typed earlier)</option>}
        {grades.map((g) => <option key={g} value={g}>{g}</option>)}
      </select>
    </label>
  </div>;
}
