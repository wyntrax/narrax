import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

export { Prisma, PrismaClient } from '@prisma/client';

/** Creates a Prisma client on the Rust-free query compiler with the pg driver adapter. */
export function createPrisma(url: string | undefined = process.env.DATABASE_URL): PrismaClient {
  if (!url) throw new Error('DATABASE_URL is not set');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}
