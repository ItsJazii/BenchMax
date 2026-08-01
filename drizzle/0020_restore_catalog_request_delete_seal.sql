CREATE TRIGGER `catalog_requests_no_delete`
BEFORE DELETE ON `catalog_requests`
BEGIN
  SELECT RAISE(ABORT, 'catalog requests are append-preserved');
END;
