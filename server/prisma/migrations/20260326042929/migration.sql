/*
  Warnings:

  - You are about to drop the column `village` on the `Parent` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "MotherTongue" AS ENUM ('TELUGU', 'URGU', 'ENGLISH');

-- CreateEnum
CREATE TYPE "BloodGroup" AS ENUM ('A_POS', 'A_NEG', 'B_POS', 'B_NEG', 'AB_POS', 'AB_NEG', 'O_POS', 'O_NEG');

-- CreateEnum
CREATE TYPE "SocialCategory" AS ENUM ('OC', 'BC_A', 'BC_B', 'BC_C', 'BC_D', 'BC_E', 'MBC_DNC', 'SC', 'ST');

-- CreateEnum
CREATE TYPE "Qualification" AS ENUM ('NO_FORMAL_EDUCATION', 'PRIMARY', 'MIDDLE_SCHOOL', 'SECONDARY', 'HIGHER_SECONDARY', 'DIPLOMA', 'ITI', 'BSC', 'BCOM', 'BA', 'BTECH', 'BE', 'BBA', 'BCA', 'BDS', 'MBBS', 'MSC', 'MCOM', 'MA', 'MTECH', 'MBA', 'MCA', 'PHD', 'OTHER');

-- AlterTable
ALTER TABLE "Class" ALTER COLUMN "name" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "Parent" DROP COLUMN "village",
ADD COLUMN     "adharnumber" TEXT,
ADD COLUMN     "qualification" "Qualification";

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "address" TEXT,
ADD COLUMN     "adharnumber" TEXT,
ADD COLUMN     "admissiondate" TIMESTAMP(3),
ADD COLUMN     "admissionno" TEXT NOT NULL DEFAULT 'TEMP',
ADD COLUMN     "bloodgroup" "BloodGroup",
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "mothertongue" "MotherTongue",
ADD COLUMN     "pincode" TEXT,
ADD COLUMN     "socialcategory" "SocialCategory",
ADD COLUMN     "weight" INTEGER,
ALTER COLUMN "dob" DROP NOT NULL;
