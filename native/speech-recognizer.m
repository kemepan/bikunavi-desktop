#import <Foundation/Foundation.h>
#import <Speech/Speech.h>

static BOOL finished = NO;
static NSString *resultOutputPath = nil;

static void printJSON(NSDictionary *payload) {
  NSError *error = nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:&error];
  if (!data || error) return;
  fwrite(data.bytes, 1, data.length, stdout);
  fputc('\n', stdout);
  fflush(stdout);
  if (resultOutputPath.length) {
    [data writeToFile:resultOutputPath options:NSDataWritingAtomic error:nil];
  }
}

static void finishOnce(NSDictionary *payload, int exitCode) {
  if (finished) return;
  finished = YES;
  printJSON(payload);
  exit(exitCode);
}

static NSString *authorizationLabel(SFSpeechRecognizerAuthorizationStatus status) {
  switch (status) {
    case SFSpeechRecognizerAuthorizationStatusAuthorized: return @"authorized";
    case SFSpeechRecognizerAuthorizationStatusDenied: return @"denied";
    case SFSpeechRecognizerAuthorizationStatusRestricted: return @"restricted";
    case SFSpeechRecognizerAuthorizationStatusNotDetermined: return @"not-determined";
  }
  return @"unknown";
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 2) {
      printJSON(@{ @"error": @"音声ファイルが指定されていません。" });
      return 2;
    }

    NSString *audioPath = [NSString stringWithUTF8String:argv[1]];
    if (argc >= 3) {
      resultOutputPath = [NSString stringWithUTF8String:argv[2]];
    }
    if (![[NSFileManager defaultManager] fileExistsAtPath:audioPath]) {
      printJSON(@{ @"error": @"音声ファイルが見つかりません。" });
      return 2;
    }

    NSURL *audioURL = [NSURL fileURLWithPath:audioPath];
    SFSpeechRecognizer *recognizer = [[SFSpeechRecognizer alloc]
      initWithLocale:[NSLocale localeWithLocaleIdentifier:@"ja-JP"]];
    if (!recognizer) {
      printJSON(@{ @"error": @"日本語のmacOS音声認識を利用できません。" });
      return 3;
    }

    __block SFSpeechRecognitionTask *recognitionTask = nil;
    void (^startRecognition)(SFSpeechRecognizerAuthorizationStatus) =
      ^(SFSpeechRecognizerAuthorizationStatus status) {
        if (status != SFSpeechRecognizerAuthorizationStatusAuthorized) {
          finishOnce(@{
            @"error": @"macOSの音声認識が許可されていません。",
            @"authorization": authorizationLabel(status)
          }, 4);
          return;
        }

        SFSpeechURLRecognitionRequest *request =
          [[SFSpeechURLRecognitionRequest alloc] initWithURL:audioURL];
        request.shouldReportPartialResults = NO;
        request.taskHint = SFSpeechRecognitionTaskHintDictation;
        request.contextualStrings = @[
          @"びくたん", @"びくにたん", @"ポモドーロ", @"Gemini",
          @"VOICEVOX", @"Live2D", @"チャッピー"
        ];

        BOOL onDevice = recognizer.supportsOnDeviceRecognition;
        if (onDevice) request.requiresOnDeviceRecognition = YES;

        recognitionTask = [recognizer recognitionTaskWithRequest:request
          resultHandler:^(SFSpeechRecognitionResult *result, NSError *error) {
            if (error) {
              // 1110は無音・発話なし。Whisperへ落とすと環境音から架空の文を
              // 作りやすいため、正常な空結果として扱う。
              if ([error.domain isEqualToString:@"kAFAssistantErrorDomain"] && error.code == 1110) {
                finishOnce(@{
                  @"text": @"",
                  @"confidence": @0,
                  @"onDevice": @(onDevice),
                  @"authorization": @"authorized",
                  @"noSpeech": @YES
                }, 0);
                return;
              }
              finishOnce(@{
                @"error": error.localizedDescription ?: @"macOS音声認識に失敗しました。",
                @"domain": error.domain ?: @"",
                @"code": @(error.code),
                @"onDevice": @(onDevice)
              }, 5);
              return;
            }
            if (!result || !result.isFinal) return;

            SFTranscription *transcription = result.bestTranscription;
            double confidenceTotal = 0;
            NSUInteger confidenceCount = 0;
            for (SFTranscriptionSegment *segment in transcription.segments) {
              confidenceTotal += segment.confidence;
              confidenceCount += 1;
            }
            double confidence = confidenceCount
              ? confidenceTotal / (double)confidenceCount
              : 0;
            finishOnce(@{
              @"text": transcription.formattedString ?: @"",
              @"confidence": @(confidence),
              @"onDevice": @(onDevice),
              @"authorization": @"authorized"
            }, 0);
          }];
      };

    SFSpeechRecognizerAuthorizationStatus status =
      [SFSpeechRecognizer authorizationStatus];
    if (status == SFSpeechRecognizerAuthorizationStatusNotDetermined) {
      [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus newStatus) {
        dispatch_async(dispatch_get_main_queue(), ^{
          startRecognition(newStatus);
        });
      }];
    } else {
      dispatch_async(dispatch_get_main_queue(), ^{
        startRecognition(status);
      });
    }

    dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, 35 * NSEC_PER_SEC),
      dispatch_get_main_queue(),
      ^{
        [recognitionTask cancel];
        finishOnce(@{ @"error": @"macOS音声認識がタイムアウトしました。" }, 6);
      }
    );
    dispatch_main();
  }
}
