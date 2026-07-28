// カレンダーへのアクセス許可が取れるかどうかだけを確かめる試作。
//
// 本実装の前に、次の3点を知りたい:
//   1. 素のコマンドで許可ダイアログが出るか（.app 形式が要るか）
//   2. 許可された後、実際に予定を数えられるか
//   3. 拒否・未許可の状態を区別できるか
//
// 予定の内容（タイトル・場所・参加者）は出力しない。件数と可否だけを返す。
#import <Foundation/Foundation.h>
#import <EventKit/EventKit.h>

static void emit(NSString *status, NSInteger count, NSString *note) {
  NSMutableDictionary *out = [NSMutableDictionary dictionary];
  out[@"status"] = status;
  if (count >= 0) out[@"todayEventCount"] = @(count);
  if (note) out[@"note"] = note;
  NSData *json = [NSJSONSerialization dataWithJSONObject:out options:0 error:nil];
  fwrite(json.bytes, 1, json.length, stdout);
  fputc('\n', stdout);
  fflush(stdout);
}

// 今日ぶんの予定を数える。件数だけ返し、中身には触れない。
static NSInteger countTodayEvents(EKEventStore *store) {
  NSCalendar *calendar = [NSCalendar currentCalendar];
  NSDate *start = [calendar startOfDayForDate:[NSDate date]];
  NSDate *end = [calendar dateByAddingUnit:NSCalendarUnitDay
                                     value:1
                                    toDate:start
                                   options:0];
  NSPredicate *predicate = [store predicateForEventsWithStartDate:start
                                                          endDate:end
                                                        calendars:nil];
  return (NSInteger)[store eventsMatchingPredicate:predicate].count;
}

int main(void) {
  @autoreleasepool {
    EKEventStore *store = [[EKEventStore alloc] init];

    // 許可を求める前の状態。ダイアログが出るのは notDetermined の時だけ。
    EKAuthorizationStatus before =
      [EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent];

    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block BOOL granted = NO;
    __block NSString *failure = nil;

    void (^handler)(BOOL, NSError *) = ^(BOOL ok, NSError *error) {
      granted = ok;
      if (error) failure = error.localizedDescription;
      dispatch_semaphore_signal(done);
    };

    // macOS 14 以降は「フルアクセス」の要求に分かれた。
    // 古い環境でも動くよう、応答するセレクタを見て使い分ける。
    if ([store respondsToSelector:@selector(requestFullAccessToEventsWithCompletion:)]) {
      [store requestFullAccessToEventsWithCompletion:handler];
    } else {
      [store requestAccessToEntityType:EKEntityTypeEvent completion:handler];
    }

    // 応答が返らない場合に備える（ダイアログが出ないまま黙る環境がある）。
    if (dispatch_semaphore_wait(
          done, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC)) != 0) {
      emit(@"timeout", -1,
           before == EKAuthorizationStatusNotDetermined
             ? @"許可ダイアログが返らなかった。.app 形式が必要かもしれない。"
             : @"許可の要求が返らなかった。");
      return 4;
    }

    if (!granted) {
      // 要求前後の状態を見ないと、ダイアログが出た上で拒否されたのか、
      // そもそも出なかったのかが区別できない。
      EKAuthorizationStatus after =
        [EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent];
      NSArray *names = @[@"notDetermined", @"restricted", @"denied",
                         @"authorized", @"writeOnly", @"fullAccess"];
      NSString *beforeName = before < names.count ? names[before] : @"unknown";
      NSString *afterName = after < names.count ? names[after] : @"unknown";
      emit(@"denied", -1,
           [NSString stringWithFormat:@"要求前=%@ / 要求後=%@ / %@",
                     beforeName, afterName,
                     failure ?: @"エラーは返っていない"]);
      return 3;
    }

    emit(@"granted", countTodayEvents(store),
         before == EKAuthorizationStatusNotDetermined
           ? @"この実行で新たに許可された。"
           : @"すでに許可されていた。");
    return 0;
  }
}
