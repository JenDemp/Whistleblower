# JENSEN Whistleblower

Statisk sajt (HTML, CSS, JavaScript utan ramverk) på GitHub Pages, med Supabase som databas och inloggning.

## Grenar

- `main` publiceras direkt till https://jendemp.github.io/Whistleblower/. Committa eller pusha inte dit utan att användaren uttryckligen bett om publicering.
- `dev` är arbetsgrenen. Gör alla ändringar där som standard.
- Vid publicering: höj `?v=` i `index.html`, slå ihop `dev` till `main`, pusha och gå tillbaka till `dev`. Se `ARBETSFLÖDE.md`.

## Testning

- `verktyg/testlage.py` kör sajten på http://localhost:8001 med `verktyg/mock-supabase.js` i stället för Supabase. Använd det för all UI-testning.
- Båda grenarna delar den riktiga Supabase-databasen. SQL i `migrations/` påverkar produktion direkt och ska köras först när koden som behöver den publiceras.

## Säkerhet

- Visselblåsarens identitet får aldrig kunna nås av handläggare. `employee_id` väljs aldrig i admin-frågor.
- Allt från databasen som sätts in med `innerHTML` ska gå genom `esc()`. Bygg annars med `textContent`.
