import {describe,expect,it} from 'vitest';
import {recordingFilename} from '../../src/features/recording/export';
describe('local take filenames',()=>{
 it('uses the selected format and replaces a previously typed audio extension',()=>{expect(recordingFilename('Gece mix.wav',1,'mp3')).toBe('Gece mix v01.mp3');expect(recordingFilename('Gece mix.MP3',2,'wav')).toBe('Gece mix v02.wav');});
 it('produces distinct version names while preserving the chosen title',()=>{expect(recordingFilename('Gece mix',1)).toBe('Gece mix v01.wav');expect(recordingFilename('Gece mix',2)).toBe('Gece mix v02.wav');});
 it('keeps WAV extensions single and removes path separators/control characters',()=>{expect(recordingFilename('../set\\A:\u0000.wav',3)).toBe('..-set-A-- v03.wav');});
 it('avoids Windows reserved names and empty download names',()=>{expect(recordingFilename('CON.wav',1)).toBe('RIMVO CON v01.wav');expect(recordingFilename('   ',1)).toBe('RIMVO mix v01.wav');});
 it('keeps Unicode names and bounds an oversized name',()=>{expect(recordingFilename('Çağrı – gecenin sesi',7)).toBe('Çağrı – gecenin sesi v07.wav');expect(recordingFilename('a'.repeat(1000),1).length).toBeLessThan(100);});
 it('invalid versions still create a valid download name',()=>{expect(recordingFilename('set',NaN)).toBe('set v01.wav');expect(recordingFilename('set',-1)).toBe('set v01.wav');});
});
