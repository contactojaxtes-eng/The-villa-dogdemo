import { ArrayMaxSize, IsArray, IsString, Matches } from 'class-validator';

export class UpdateModuleVisibilityDto {
  @IsArray()
  @ArrayMaxSize(64)
  @IsString({ each: true })
  @Matches(/^[a-z][a-z0-9_]{0,63}$/, { each: true })
  hiddenModules: string[];
}
