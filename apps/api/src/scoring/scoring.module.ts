import { Module } from '@nestjs/common';
import { RubricController } from './rubric.controller';
import { RubricService } from './rubric.service';

@Module({
  controllers: [RubricController],
  providers: [RubricService],
  exports: [RubricService],
})
export class ScoringModule {}
