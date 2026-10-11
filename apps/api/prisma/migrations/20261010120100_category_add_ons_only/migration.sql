-- A category that is not sold on its own (a POS import's «Дополнительные
-- ингредиенты»): hidden from customer menus and refused by the cart. A POS
-- sync never writes it, so the owner's choice survives a re-import.
-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "addOnsOnly" BOOLEAN NOT NULL DEFAULT false;
