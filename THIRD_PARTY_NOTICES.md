# Third-party notices

## Chessground

The YPAAT Study board uses **Chessground** by the Lichess team.

- Source: https://github.com/lichess-org/chessground
- License: GPL-3.0-or-later
- Version used by the Study page: 10.2.0
- Browser package is loaded from the published package distribution.

Chessground provides the interactive chessboard UI, piece dragging, board rendering, coordinates, and drawing support. Chessground itself does not provide chess rules; YPAAT uses a separate chess rules library for move validation.

Because Chessground is GPL-3.0-or-later, review the GPL source-distribution requirements before deploying the Study feature to users. The Lichess project also publishes its full Study implementation under its open-source licenses; YPAAT implements its own Redis/Vercel study data and sharing layer rather than copying the Lichess server backend.
