# Migrationer

Historiken över hur databasen har förändrats. **Kör inte de här filerna** —
de är redan körda. De finns för spårbarhet.

Vill du veta hur databasen ser ut *nu*, läs [`../schema.sql`](../schema.sql).

## Filer

| Fil | Innehåll |
|---|---|
| `2026-09_steg-0-7.sql` | Allt fram till 2026-09-09, i den ordning det kördes: v2-schemat (tre anmälartyper) plus sju tilläggssteg — delad admin-inkorg, super-admin, ämnesrad, avsändarnamn i chatten, atomiskt ärendeskapande. |

## Hur du gör en ny ändring

1. Skriv ändringen som en ny fil här: `ÅÅÅÅ-MM_kort-beskrivning.sql`
2. Kör den i Supabase → SQL Editor
3. **Skriv in resultatet i `schema.sql`** så nuläget stämmer

Steg 3 är det som är lätt att glömma. Gör man inte det slutar `schema.sql`
beskriva verkligheten, och då är den värdelös. Det hände redan en gång:
`add_anonymous_message` implementerades direkt i SQL Editor och den gamla
`setup.sql` blev kvar med en stubbe som alltid returnerade `false`.

## Varför uppdelningen finns

Den gamla `setup.sql` innehöll till slut **fyra** definitioner av
`get_case_by_code` och två av `create_anonymous_case`, staplade på varandra
i den ordning de skrevs. Filen gav rätt resultat om man körde den uppifrån
och ner, men gick inte att *läsa* — för att förstå vad en funktion gjorde
fick man hitta alla versioner och räkna ut vilken som vann.
