# Loading Indicators

The app shows when it is waiting for the database.

- **Loading overlay** — while the workspace first loads, and while you switch to another workspace, a spinner
  covers the canvas.
- **Activity indicator** — a small spinner in the bottom-right corner while a later database request is
  running (for example after an edit). It appears only if the request takes longer than about 0.2 seconds, so
  quick actions do not flicker, and it never blocks clicks.
- Both stop spinning when your system asks for reduced motion.

## Notes

- Only database (SPARQL) requests count towards the corner indicator.
- In a development build, the browser console logs a table of how long each start-up step took and how many
  requests were sent. It does not appear in a production build.

## Related

- [Add Entities from Namespace](add-entities-from-namespace)
