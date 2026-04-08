const app = require('./app');
const initDefaultUser = require('./init/initUser');

const port = process.env.PORT || 3000;

async function bootstrap() {
  await initDefaultUser();
  app.listen(port, () => {
    console.log(`Server running on ${port}`);
  });
}

bootstrap();
