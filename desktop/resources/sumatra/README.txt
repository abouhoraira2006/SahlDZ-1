# SumatraPDF (portable)
#
# Downloaded by `npm run fetch:sumatra` inside desktop/. It is intentionally not
# committed: the ~2 MB binary would bloat every clone, and the exact version is
# pinned by that script instead.
#
# main.js looks for SumatraPDF.exe in this folder (dev) and in
# resources/sumatra (packaged). When neither exists, printing falls back to the
# browser print dialog rather than failing the ticket.
