import yargs, { CommandModule } from 'yargs';
import { hideBin } from 'yargs/helpers';
import ModuleFactory from './module-factory';
import StatementFactory from './statement-factory';

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

  handler: async (argv) => {
    ModuleFactory.verify(argv.id);
  },
};

interface MakeStatementArgs {
  sequence: number;
  revoke: string[];
  add: string[];
  keep: string[];
  date?: string;
}

export const makeStatementCommand: CommandModule<unknown, MakeStatementArgs> = {
  command: 'make-statement',
  describe:
    'Writes an unsigned key statement to keys/statements/, revoking and adding primary keys',

  builder: (y) =>
    y
      .option('sequence', {
        type: 'number',
        describe: "The statement's number: 1, 2, 3, ...",
        demandOption: true,
      })
      .option('revoke', {
        type: 'string',
        array: true,
        default: [],
        describe:
          'A primary key to revoke, written <key id>:<reason> (repeatable)',
      })
      .option('add', {
        type: 'string',
        array: true,
        default: [],
        describe: "A new primary key's public.pem file (repeatable)",
      })
      .option('keep', {
        type: 'string',
        array: true,
        default: [],
        describe:
          'The manifest of a module a revoked key signed legitimately, to keep trusting it (repeatable)',
      })
      .option('date', {
        type: 'string',
        describe: 'issuedAt, YYYY-MM-DD (default: today)',
      })
      .help('h')
      .alias('h', 'help')
      .strict(),

  handler: async (argv) => {
    StatementFactory.make({
      sequence: argv.sequence,
      revoke: argv.revoke,
      add: argv.add,
      keep: argv.keep,
      issuedAt: argv.date,
    });
  },
};

interface StatementArgs {
  sequence: number;
  key?: string;
}

export const signStatementCommand: CommandModule<unknown, StatementArgs> = {
  command: 'sign-statement',
  describe: 'Checks a key statement, then signs it with a backup key',

  builder: (y) =>
    y
      .option('sequence', {
        type: 'number',
        describe: "The statement's number",
        demandOption: true,
      })
      .option('key', {
        type: 'string',
        describe:
          'A backup private key PEM file. Leave it out to paste the key into standard input instead',
      })
      .help('h')
      .alias('h', 'help')
      .strict(),

  handler: async (argv) => {
    await StatementFactory.sign(argv.sequence, argv.key);
  },
};

export const checkStatementCommand: CommandModule<unknown, StatementArgs> = {
  command: 'check-statement',
  describe: 'Checks a key statement and its signature, as Bible Nav will',

  builder: (y) =>
    y
      .option('sequence', {
        type: 'number',
        describe: "The statement's number",
        demandOption: true,
      })
      .help('h')
      .alias('h', 'help')
      .strict(),

  handler: async (argv) => {
    StatementFactory.check(argv.sequence);
  },
};

// 5. Wire up to process.argv
yargs(hideBin(process.argv))
  .command(generateCommand)
  .command(signCommand)
  .command(verifyCommand)
  .command(makeStatementCommand)
  .command(signStatementCommand)
  .command(checkStatementCommand)
  .demandCommand(1, 'You need at least one command before moving on')
  .help()
  .fail(false)
  .parseAsync()
  .catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
