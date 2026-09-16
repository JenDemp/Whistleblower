# Arbetsflöde: testa innan det går live

## Två grenar

| Gren | Vad den är till för |
|---|---|
| `main` | Det som ligger ute på https://jendemp.github.io/Whistleblower/. Allt som hamnar här syns för alla inom ungefär en minut. |
| `dev` | Här byggs och testas ändringar. Ingenting här syns på den riktiga sajten. |

Grundregeln är enkel: **ändra på `dev`, testa, och flytta över till `main` först när det fungerar.**

## Testa på din egen dator

Dubbelklicka på en av startfilerna i projektmappen. Ett svart fönster öppnas och sajten visas i webbläsaren. Stäng fönstret för att avsluta.

| Startfil | Databas | När den ska användas |
|---|---|---|
| `Starta testläge.bat` | Påhittad data i webbläsaren | Nästan alltid. Inget du gör kan röra riktiga ärenden. |
| `Starta lokalt.bat` | Den **riktiga** databasen | Bara när något måste provas mot riktig data. |

**I testläget** loggar du in via den gula panelen nere till höger, utan lösenord. Du kan välja HR, anmälare med e-post eller öppen anmälare. Ett helt anonymt ärende öppnar du med koden `TESTKOD-ANON-123`. Allt nollställs när sidan laddas om.

**Med den riktiga databasen** hamnar allt du skickar bland riktiga ärenden. Skriv `TEST` i ämnesraden och ta bort ärendet efteråt.

Båda startfilerna kräver Python, som redan finns på din dator.

## Steg för steg

Kommandona skrivs i en terminal i projektmappen.

**1. Gå till dev-grenen och hämta det senaste**

```
git checkout dev
git pull
```

**2. Gör ändringen och testa den**

Spara filerna, starta testläget och ladda om sidan. Upprepa tills det ser rätt ut.

**3. Spara ändringen på dev**

```
git add -A
git commit -m "Kort beskrivning av ändringen"
git push
```

Nu finns ändringen på GitHub, men den syns inte på sajten.

**4. Publicera när det fungerar**

Höj först versionsnumret `?v=` i `index.html`, alla ställen där det står, så att webbläsare hämtar de nya filerna. Sedan:

```
git checkout main
git pull
git merge dev
git push
git checkout dev
```

Sista raden tar dig tillbaka till dev, så att nästa ändring också görs där.

## Om något gick fel

**Om det bara finns på `dev`** har ingen annan sett det. Rätta felet och gör en ny commit.

**Om det redan ligger ute på `main`** backar du med `git revert`. Det skapar en ny commit som tar bort ändringen, utan att skriva om historiken:

```
git checkout main
git log --oneline -5
git revert <kod från listan, t.ex. 54ec551>
git push
```

Gör sedan samma revert på dev med `git checkout dev` och `git merge main`, så att grenarna är överens.

## Databasändringar

Båda grenarna använder samma Supabase-databas. En SQL-ändring slår därför igenom direkt mot den riktiga sajten, oavsett vilken gren koden ligger på.

- Kör en ny SQL-fil från `migrations/` **först när koden som behöver den publiceras** till `main`.
- Testa gärna koden i testläget innan dess. Där behövs ingen SQL alls.
- Skriv in ändringen i `schema.sql` efteråt, enligt `migrations/README.md`.

## Be Claude

Säg "gör ändringen på dev" för att bygga något nytt. Säg "publicera till main" när det är färdigtestat.
