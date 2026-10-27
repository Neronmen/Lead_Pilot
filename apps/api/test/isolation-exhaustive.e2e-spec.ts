import { Controller, Delete, Get, Patch } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import type { Env } from '../src/config/env.schema';
import { EMAIL_PROVIDER } from '../src/email/email.provider';
import { MockEmailProvider } from '../src/email/mock-email.provider';
import {
  MEMBER_BY_ID,
  OWN,
  PUBLIC,
  registeredRoutes,
  WORKSPACE_BY_ID,
  WORKSPACE_COLLECTION,
} from './utils/routes';

/**
 * Proves the isolation matrix is exhaustive: a controller nobody classified
 * shows up in the "unclassified" list, whatever shape it has. The scratch
 * controllers below exist only in this test's module.
 */
class BaseScratch {
  @Get('inherited/:id')
  inherited(): string {
    return 'x';
  }
}

@Controller('scratch')
class ScratchController extends BaseScratch {
  @Get(':id')
  read(): string {
    return 'x';
  }

  @Patch(':id')
  change(): string {
    return 'x';
  }

  @Delete(['a', 'b'])
  twoPaths(): string {
    return 'x';
  }
}

@Controller({ path: 'object-form' })
class ObjectFormController {
  @Get()
  list(): string {
    return 'x';
  }
}

describe('Isolation matrix is exhaustive (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ScratchController, ObjectFormController],
    })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue(new MockEmailProvider())
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app, app.get<ConfigService<Env, true>>(ConfigService));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists a route nobody classified, including inherited and unusual ones', () => {
    const classified = new Set([
      ...PUBLIC,
      ...OWN,
      ...MEMBER_BY_ID,
      ...WORKSPACE_COLLECTION,
      ...WORKSPACE_BY_ID,
    ]);
    const unclassified = registeredRoutes(app).filter((route) => !classified.has(route));
    expect(unclassified).toEqual([
      'DELETE /scratch/a,b',
      'GET /object-form',
      'GET /scratch/:id',
      'GET /scratch/inherited/:id',
      'PATCH /scratch/:id',
    ]);
  });
});
