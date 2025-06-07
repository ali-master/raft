import { IsString, IsNotEmpty, Length } from 'class-validator';

export class SetKvDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 4096) // Example: Enforce a max value length (adjust as needed)
  value: string;
}
