import yargs, { CommandModule } from 'yargs';
import { hideBin } from 'yargs/helpers';
import ModuleFactory from './module-factory';
import ChecksumFactory from './checksum-factory';

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

  handler: (argv) => {
    ModuleFactory.generate(argv.id);
  },
};

interface ChecksumArgs {
  id: string;
}

export const checksumCommand: CommandModule<unknown, ChecksumArgs> = {
  command: 'checksum',
  describe: 'Creates a checksum file for a given set of USX files',

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
    ChecksumFactory.generate(argv.id);
  },
};

// 5. Wire up to process.argv
yargs(hideBin(process.argv))
  .command(generateCommand)
  .command(checksumCommand)
  .demandCommand(1, 'You need at least one command before moving on')
  .help()
  .parse();
