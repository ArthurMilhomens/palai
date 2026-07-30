import argon2 from 'argon2';
import { Role } from '@prisma/client';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@palai.local';
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? 'ChangeMeAdmin123!';

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    create: {
      email: email.toLowerCase(),
      passwordHash,
      role: Role.ADMIN,
    },
    update: {
      role: Role.ADMIN,
      passwordHash,
      deletedAt: null,
    },
  });

  console.log(`Admin ready: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
