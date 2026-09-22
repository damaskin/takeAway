-- Poster returns product photos as paths relative to its own site
-- (`/upload/pos_cdb_.../menu/product_....jpeg`) and the menu import stored them
-- verbatim, so every imported photo resolved against takeaway.md (or the
-- mobile app) and came back broken. The importer now writes absolute URLs;
-- this repairs the rows already stored. Only Poster's `/upload/` paths are
-- touched, and the order of each product's photos is kept.
UPDATE "Product"
SET "imageUrls" = ARRAY(
  SELECT CASE WHEN url LIKE '/upload/%' THEN 'https://joinposter.com' || url ELSE url END
  FROM unnest("imageUrls") WITH ORDINALITY AS photo(url, position)
  ORDER BY position
)
WHERE EXISTS (SELECT 1 FROM unnest("imageUrls") AS photo(url) WHERE url LIKE '/upload/%');
