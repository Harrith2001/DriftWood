import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Experience } from './features/experience/experience';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Experience],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {}
