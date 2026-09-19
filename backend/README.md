# Backend outline

Run `npm start` (or `npm.cmd start` in Windows PowerShell) with Node 22+.
`GET /api/health` returns a JSON health check. No dependencies required.

The frontend currently opens a WhatsApp enquiry. There is no booking database, automatic scheduling, or submitted-form storage.

Future structure inside this folder: `src/routes` for enquiry and availability endpoints, `src/controllers` for request handling, `src/services` for scheduling and notifications, and `src/models` for persistence. Implement validation, rate limits, privacy policy, and authentication for administrative access when those features are introduced.
