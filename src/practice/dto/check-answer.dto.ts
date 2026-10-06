import { IsNotEmpty, IsString } from 'class-validator';

export class CheckAnswerDto {
  @IsString()
  @IsNotEmpty()
  userAnswer!: string;
}
