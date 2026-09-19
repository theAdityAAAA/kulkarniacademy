# Kulkarni Academy

Responsive React website built with Vite. React DOM is used because this is a browser landing page; React Native primarily targets mobile applications.

## Run

```sh
npm install
npm run dev
```

On Windows PowerShell, use `npm.cmd` if script execution is disabled. Open the local URL shown by Vite.

## Production

```sh
npm run build
npm run preview
```

Deploy the generated `dist` directory to a static host. The backend is optional for this landing page.

## Content and contact

Edit `src/main.jsx` for copy, FAQs, pricing, and the WhatsApp number. The provided Indian phone number uses country code +91. Pricing is represented as USD per class; confirm the intended billing unit before publishing. Maths and Science across all national and international boards are offered. Class duration and the student?s specific syllabus are discussed during enquiry. No invented testimonials or achievement statistics are used.

The trial form validates required fields and prepares a WhatsApp message. Visitors must send it themselves, and trial scheduling is confirmed in conversation. Nothing is stored by this website. Google Fonts are requested externally with system font fallbacks.

## Student discovery activity

The six-question activity in `src/LearningExplorer.jsx` asks about interests, approach to challenges, lesson preferences, and goals, followed by two introductory understanding questions. Results report the student's choices and a score out of two; they are not a personality assessment, diagnosis, fixed learning-style classification, or curriculum-level placement. Responses live only in React state. Sharing the snapshot is optional and goes through the existing WhatsApp enquiry flow.

`src/LearningMap.jsx` contains the illustrated learning journey. `src/readability.css` provides the larger, heavier type scale, darker text colours, visual activity styles, and responsive layouts.

Run `npm.cmd test` to build and check the enquiry flow, challenges, discovery activity, scoring, back navigation, reset, and sharing.
