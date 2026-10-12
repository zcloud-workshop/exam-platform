import { randomBytes } from 'crypto';

import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const existingAdmin = await prisma.user.findUnique({ where: { username: 'admin' } });
  const initialPassword = randomBytes(12).toString('base64url');

  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      password: await bcrypt.hash(initialPassword, 10),
      role: Role.super_admin,
    },
  });

  await prisma.questionBank.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      name: '默认题库',
      description: '系统默认题库',
      createdBy: admin.id,
    },
  });

  if (existingAdmin) {
    console.log('Admin already exists, password unchanged. Default question bank ensured.');
  } else {
    console.log(`Seed data created: admin/${initialPassword}, default question bank (owned by admin)`);
    console.log('Save the initial password now, rerunning the seed will not reset it.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
