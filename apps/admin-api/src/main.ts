import '../../../scripts/load-env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.ADMIN_API_PORT || 3009;
  await app.listen(port);
  console.log(`🚀 Admin API running on http://localhost:${port}`);
}
bootstrap();
