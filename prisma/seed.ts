import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      password: hashedPassword,
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

  console.log('Seed data created: admin/admin123, default question bank (owned by admin)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
