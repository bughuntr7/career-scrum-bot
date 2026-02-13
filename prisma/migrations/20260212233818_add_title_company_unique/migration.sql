/*
  Warnings:

  - A unique constraint covering the columns `[userId,externalUrl]` on the table `JobApplication` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[title,company]` on the table `JobApplication` will be added. If there are existing duplicate values, this will fail.
  - Made the column `externalUrl` on table `JobApplication` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "JobApplication" ALTER COLUMN "externalUrl" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "JobApplication_userId_externalUrl_key" ON "JobApplication"("userId", "externalUrl");

-- CreateIndex
CREATE UNIQUE INDEX "JobApplication_title_company_key" ON "JobApplication"("title", "company");
