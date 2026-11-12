import yargs, { CommandModule } from 'yargs';
import { hideBin } from 'yargs/helpers';
import ModuleFactory from './module-factory';

interface GenerateArgs {
  id: string;
}

export const generateCommand: CommandModule<unknown, GenerateArgs> = {
  command: 'generate',
  describe: 'Generates a Bible Nav module',

  builder: (y) =>
    y
      .option('id', {
        alias: 'id',
        type: 'string',
        describe: 'The module ID to read from the assets folder',
        demandOption: true, // Make it required
      })
      .help('h') // Enable --help with alias -h
      .alias('h', 'help')
      .strict(),

  handler: async (argv) => {
    await ModuleFactory.generate(argv.id);
  },
};

interface SignArgs {
  id: string;
  key?: string;
}

export const signCommand: CommandModule<unknown, SignArgs> = {
  command: 'sign',
  describe: 'Checks a generated module, then adds a signature to its manifest',

  builder: (y) =>
    y
      .option('id', {
        type: 'string',
        describe: 'The module ID to read from the assets folder',
        demandOption: true,
      })
      .option('key', {
        type: 'string',
        describe:
          'An Ed25519 private key PEM file. Leave it out to paste the key into standard input instead',
      })
      .help('h')
      .alias('h', 'help')
      .strict(),

  handler: async (argv) => {
    await ModuleFactory.sign(argv.id, argv.key);
  },
};

interface VerifyArgs {
  id: string;
}

export const verifyCommand: CommandModule<unknown, VerifyArgs> = {
  command: 'verify',
  describe:
    'Checks a generated module against its USX files, word for word, and its manifest and signatures',

  builder: (y) =>
    y
      .option('id', {
        alias: 'id',
        type: 'string',
        describe: 'The module ID to read from the assets folder',
        demandOption: true, // Make it required
      })
      .help('h') // Enable --help with alias -h
      .alias('h', 'help')
      .strict(),

  handler: (argv) => {
    ModuleFactory.verify(argv.id);
  },
};

// 5. Wire up to process.argv
yargs(hideBin(process.argv))
  .command(generateCommand)
  .command(signCommand)
  .command(verifyCommand)
  .demandCommand(1, 'You need at least one command before moving on')
  .help()
  .fail(false)
  .parseAsync()
  .catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
