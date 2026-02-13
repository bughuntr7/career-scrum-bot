import { ApplicationStatus } from "@prisma/client";

import { prisma } from "./prisma";

export async function upsertJobApplication(params: {
  userId: number;
  title: string;
  company: string;
  externalUrl: string;
  jobrightUrl?: string | null;
  location?: string | null;
  jobrightMatchScore?: number | null;
  jobrightBoard?: string | null;
  jobrightJobId?: string | null;
}) {
  const {
    userId,
    title,
    company,
    externalUrl,
    jobrightUrl,
    location,
    jobrightMatchScore,
    jobrightBoard,
    jobrightJobId,
  } = params;

  // Check for duplicate by title + company (regardless of user)
  const duplicate = await prisma.jobApplication.findFirst({
    where: {
      title,
      company,
    },
  });

  if (duplicate) {
    // Duplicate found - don't create new record, just return existing
    return duplicate;
  }

  // Find existing record using the compound unique constraint (userId + externalUrl)
  const existing = await prisma.jobApplication.findFirst({
    where: {
      userId,
      externalUrl,
    },
  });

  if (existing) {
    // Update existing record
    return prisma.jobApplication.update({
      where: { id: existing.id },
      data: {
        title,
        company,
        jobrightUrl,
        location,
        jobrightMatchScore,
        jobrightBoard,
        jobrightJobId,
      },
    });
  } else {
    // Create new record
    return prisma.jobApplication.create({
      data: {
        userId,
        title,
        company,
        externalUrl,
        jobrightUrl,
        location,
        jobrightMatchScore,
        jobrightBoard,
        jobrightJobId,
        status: ApplicationStatus.SAVED,
      },
    });
  }
}

