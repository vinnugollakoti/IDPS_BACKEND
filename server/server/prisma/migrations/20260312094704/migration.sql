/*
  Warnings:

  - Changed the type of `name` on the `Class` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "Class" DROP COLUMN "name",
ADD COLUMN     "name" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Class_name_section_key" ON "Class"("name", "section");
