# Syllabus topic lists

These files are the topic lists used by the portal's syllabus tracker. `index.json` lists them all.

Every file has a `source` link to the official specification it came from. Topic and sub-topic **headings** were taken from that document, and each one was checked word-for-word against it. The descriptive text was not copied.

| Board | Syllabi | Version |
|---|---|---|
| Cambridge IGCSE | 0580 Maths (Core/Extended), 0606 Additional Maths, 0610 Biology, 0620 Chemistry, 0625 Physics, 0653 Combined Science | 2025–2027 / 2026–2028 syllabuses |
| Edexcel International GCSE | 4MA1 Maths A (Foundation/Higher), 4BI1, 4CH1, 4PH1 | current issues |
| GCSE (UK) | AQA 8300 Maths (same DfE content as Edexcel 1MA1 and OCR J560), 8461, 8462, 8463, 8464 Trilogy | current specifications |
| Cambridge AS & A Level | 9709 Mathematics | 2026–2027 |
| US Common Core | Mathematics Grade 6, 7, 8 and High School (domains → clusters) | 2010 standards |
| Singapore O-Level | 4052 Maths, 4049 Additional Maths, 6091, 6092, 6093 | 2026 (from 2027 it's called the SEC, same codes) |
| NCEA (New Zealand) | Level 1: Mathematics and Statistics, Science, Chemistry and Biology, Physics/Earth and Space Science. Levels 2 and 3: Mathematics and Statistics (Level 3 grouped as Calculus and Statistics), Physics, Chemistry, Biology, Earth and Space Science. Each achievement standard is one topic, with its credits and internal/external label | standards current for 2026, from NZQA's standards lists |

Not included yet:
- **IB Diploma and MYP.** IB's website blocks automated downloads. To add them, save the official subject guides from a browser. MYP has no fixed topic list, because each school writes its own units.
- **Cambridge Lower Secondary.** The curriculum frameworks aren't publicly linked.

## Updating

When a board publishes a new syllabus, add it as a new file with new years in its `id`. Keep the old file until students have finished it. Ticks are stored per `id`, so an existing student's progress is never mixed up between syllabuses.
