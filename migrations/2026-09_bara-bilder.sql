-- ================================================================
-- BILAGOR BEGRÄNSAS TILL BILDER
--
-- Formuläret tar nu bara emot JPG, PNG, GIF och WEBP. Samma lista sätts
-- här på själva bucketen, så att Storage avvisar allt annat även om
-- någon anropar API:t direkt och går förbi kontrollen i webbläsaren.
--
-- Filer som redan ligger i bucketen påverkas inte — äldre PDF:er finns
-- kvar och visas som länk i ärendet.
-- ================================================================

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    file_size_limit    = 52428800
where id = 'case-attachments';
