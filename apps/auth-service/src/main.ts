import '../../../scripts/load-env';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  const port = process.env.AUTH_SERVICE_PORT || 3010;
  await app.listen(port);
  console.log(`🚀 Auth Service running on http://localhost:${port}`);
}
bootstrap();
