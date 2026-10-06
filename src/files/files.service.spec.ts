import { FilesService } from './files.service';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from './s3.service';
import type { File, Prisma } from '@prisma/client';

describe('FilesService storage failures', () => {
  const create = jest.fn<Promise<File>, [Prisma.FileCreateArgs]>();
  const findUnique = jest.fn();
  const deleteFile = jest.fn();
  const upload = jest.fn();
  const deleteObject = jest.fn();
  const service = new FilesService(
    {
      file: { create, findUnique, delete: deleteFile },
    } as unknown as PrismaService,
    { upload, delete: deleteObject } as unknown as S3Service,
  );
  const file = {
    originalname: 'image.png',
    mimetype: 'image/png',
    size: 3,
    buffer: Buffer.from('png'),
  } as Express.Multer.File;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('removes the uploaded object if metadata persistence fails', async () => {
    const error = new Error('database unavailable');
    create.mockRejectedValue(error);
    await expect(
      service.upload(file, 'user', { id: 'q', bankId: 'b', extension: 'png' }),
    ).rejects.toThrow(error);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith(
      expect.stringMatching(
        /^question-banks\/b\/questions\/q\/images\/[^/]+\.png$/,
      ),
    );
    expect(create.mock.calls[0][0].data).toMatchObject({
      questionId: 'q',
      url: null,
    });
  });

  it('keeps metadata when S3 deletion fails so the removal can be retried', async () => {
    findUnique.mockResolvedValue({ id: 'image', s3Key: 'key' });
    deleteObject.mockRejectedValue(new Error('storage unavailable'));
    await expect(service.remove('image')).rejects.toThrow(
      'storage unavailable',
    );
    expect(deleteFile).not.toHaveBeenCalled();
  });
});
